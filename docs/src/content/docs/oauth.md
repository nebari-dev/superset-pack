---
title: Keycloak OAuth
description: How Superset authenticates against Keycloak and maps groups to Superset roles.
---

Superset runs the OAuth flow itself, through
[Flask-AppBuilder](https://flask-appbuilder.readthedocs.io/). The gateway routes; it does
not authenticate.

```yaml
nebariapp:
  auth:
    enabled: true
    provider: keycloak
    provisionClient: true
    enforceAtGateway: false
    redirectURI: "/oauth-authorized/keycloak"
    scopes: [openid, profile, email]
```

## Why `enforceAtGateway: false`

An Envoy `SecurityPolicy` in front of Superset would authenticate the user and forward an
already-authorized request — and Superset would have no idea who they were, because
Flask-AppBuilder's user model is populated by its *own* OAuth callback. You would get a
double login, or a logged-in gateway session in front of a Superset that still shows a
login page.

Letting Superset own the flow is what makes `AUTH_ROLES_MAPPING` work at all.

`redirectURI: /oauth-authorized/keycloak` is Flask-AppBuilder's callback path for a
provider named `keycloak`. Rename the provider in `OAUTH_PROVIDERS` and this must change to
match.

## The OIDC secret

With `provisionClient: true` the operator creates a confidential client in the realm and
writes a Secret named `<release>-nebari-superset-oidc-client`:

| Key | Contents |
|---|---|
| `client-id` | OIDC client ID |
| `client-secret` | client secret |
| `issuer-url` | Keycloak issuer URL |

Inject it into Superset with `extraEnvRaw`:

```yaml
superset:
  extraEnvRaw:
    - name: OAUTH_CLIENT_ID
      valueFrom:
        secretKeyRef:
          name: superset-nebari-superset-oidc-client
          key: client-id
    - name: OAUTH_CLIENT_SECRET
      valueFrom:
        secretKeyRef:
          name: superset-nebari-superset-oidc-client
          key: client-secret
    - name: OAUTH_SERVER_METADATA_URL
      valueFrom:
        secretKeyRef:
          name: superset-nebari-superset-oidc-client
          key: issuer-url
          optional: true
```

:::caution[The secret name embeds your release name]
It is `<release>-nebari-superset-oidc-client`, so a release named `superset` gives
`superset-nebari-superset-oidc-client`. The examples hardcode that value, so update it if
you install under a different release name.

Getting it wrong does not produce a login error, because `client-id` and `client-secret`
are not marked `optional`: the `superset`, `superset-worker`, and `superset-init-db`
containers never start at all. They sit in `Waiting` with reason
`CreateContainerConfigError`. The init containers only read `superset-env`, so they pass,
which makes the pod look like it cleared the database wait before stalling.

```bash
kubectl -n superset get pods
```

The reason is in the container state, and the detail naming the missing secret or key is in
the events rather than the state block:

```bash
kubectl -n superset get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.containerStatuses[*].state.waiting.reason}{"\n"}{end}'
kubectl -n superset get events --field-selector reason=Failed
```
:::

Confirm it exists before debugging anything else:

```bash
kubectl -n superset get secret superset-nebari-superset-oidc-client -o jsonpath='{.data}' | jq 'keys'
```

## The Superset config

OAuth is configured through `superset.configOverrides.oauth_config`, a Python snippet the
upstream chart appends to `superset_config.py`. The complete block is in
[`examples/nebari-values.yaml`](https://github.com/nebari-dev/superset-pack/blob/main/examples/nebari-values.yaml);
the parts that matter:

```python
class CustomSecurityManager(SupersetSecurityManager):
    def oauth_user_info(self, provider, response=None):
        if provider == 'keycloak':
            me = self.appbuilder.sm.oauth_remotes[provider].userinfo()
            roles = me.get('roles', me.get('groups', []))
            return {
                'username': me.get('preferred_username', ''),
                'first_name': me.get('given_name', ''),
                'last_name': me.get('family_name', ''),
                'email': me.get('email', ''),
                'role_keys': roles,
            }
        return super().oauth_user_info(provider, response)

CUSTOM_SECURITY_MANAGER = CustomSecurityManager
AUTH_TYPE = AUTH_OAUTH
```

The security manager exists to produce **`role_keys`**. Flask-AppBuilder looks those up in
`AUTH_ROLES_MAPPING`; without the override there are no role keys and every user falls
through to the registration role.

Note the fallback: `me.get('roles', me.get('groups', []))`. Keycloak may present the
information as realm roles or as group membership depending on the mappers configured on
the client, and the code accepts either.

## Role mapping

```python
AUTH_USER_REGISTRATION = True
AUTH_USER_REGISTRATION_ROLE = "Gamma"
AUTH_ROLES_MAPPING = {
    'superset-admin':  ['Admin'],
    'superset-user':   ['Gamma'],
    'superset-public': ['Public'],
}
AUTH_ROLES_SYNC_AT_LOGIN = True
AUTH_ROLE_ADMIN = 'Admin'
AUTH_ROLE_PUBLIC = 'Public'
```

| Setting | Effect |
|---|---|
| `AUTH_USER_REGISTRATION` | Creates a Superset user on first login instead of rejecting unknown users. |
| `AUTH_USER_REGISTRATION_ROLE` | Role for a user matching nothing in the mapping. `Gamma` is Superset's standard limited role. |
| `AUTH_ROLES_MAPPING` | Keycloak group or role name → Superset roles. |
| `AUTH_ROLES_SYNC_AT_LOGIN` | Re-evaluates roles on **every** login, so Keycloak stays authoritative. Without it, roles are assigned once at registration and drift forever. |

The mapping keys must match the group names in `nebariapp.auth.groups`. They are two halves
of one configuration and there is no validation tying them together.

:::caution[`AUTH_USER_REGISTRATION: True` plus an empty group list admits the whole realm]
Any authenticated realm user gets a Superset account in the registration role. If Superset
should be restricted, list the permitted groups in `nebariapp.auth.groups` and confirm the
Keycloak client only issues the claim for members.
:::

## Scopes and claims

`nebariapp.auth.scopes` requests `openid`, `profile`, and `email` from the operator side.
The Superset side asks for more:

```python
'client_kwargs': {'scope': 'openid profile email roles'},
```

The extra `roles` scope is what puts group or role information into the userinfo response
that `oauth_user_info` reads. If every user lands in `Gamma` regardless of their Keycloak
groups, this is the first thing to check — followed by whether the client actually has a
mapper emitting the claim.

Log what Keycloak returns:

```bash
kubectl -n superset logs deploy/superset | grep "Keycloak userinfo"
```

The example security manager logs the full userinfo payload at info level, which shows
exactly which claim is present and what it contains.

That payload includes the user's email and name, on every login, in plain pod logs. It is a
debugging aid rather than a setting to leave on: drop the `logger.info` line from
`oauth_config` once role mapping works, or lower it to `debug`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Redirect loop | `redirectURI` does not match Flask-AppBuilder's callback path, or the client's registered redirect URI is stale. |
| Pod stuck in `CreateContainerConfigError` | The `extraEnvRaw` secret name or key does not match the actual secret. `client-id` and `client-secret` are not optional, so the container cannot start. |
| "Invalid client" from Keycloak | The secret exists but its `client-id` or `client-secret` is stale or empty, usually after the Keycloak client was re-provisioned or its secret rotated. |
| Login fails with an opaque Authlib error | `issuer-url` is missing from the secret, or present but empty. Missing is tolerated because it is the one key marked `optional: true`; either way the pod starts and `server_metadata_url` falls back to `''`. |
| Every user is `Gamma` | The `roles` claim is missing — scope or client mapper — or the group names do not match `AUTH_ROLES_MAPPING`. |
| Double login prompt | `enforceAtGateway` got set to `true`; check for a `SecurityPolicy`. |
| Login succeeds, then 500 | Often a `SUPERSET_SECRET_KEY` rotation — see [Secret key](/secret-key/). |

## Local accounts alongside OAuth

`AUTH_TYPE = AUTH_OAUTH` replaces the local login form. The `admin` account the upstream
chart bootstraps still exists in the metadata database and can be reached with
`AUTH_TYPE = AUTH_DB` temporarily if you lock yourself out — useful when a role mapping
change leaves nobody with `Admin`.
