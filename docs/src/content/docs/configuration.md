---
title: Configuration
description: Values reference for the Nebari Superset Pack Helm chart.
---

The chart owns `nebariapp`, `secretKey`, and the name overrides. Everything under
`superset` passes through to the
[upstream Apache Superset chart](https://github.com/apache/superset/tree/master/helm/superset)
(version 0.17.2, Superset 6.1.0).

## `nebariapp`

| Value | Default | Purpose |
|---|---|---|
| `nebariapp.enabled` | `false` | Render the `NebariApp`. |
| `nebariapp.hostname` | `""` | **Required when enabled** — the render fails without it. |
| `nebariapp.service.name` | `""` → `<release>` | Backend service. |
| `nebariapp.service.port` | `8088` | Backend port. |
| `nebariapp.routing` | *unset* | HTTPRoute and TLS. **No route is created when unset** — see below. |
| `nebariapp.gateway` | `public` | `public` or `internal`. |
| `nebariapp.landingPage` | *unset* | Nebari landing-page tile. |

:::caution[`routing` unset means no HTTPRoute and no certificate]
The operator provisions routing only when the block is present. The `NebariApp` reconciles
cleanly either way, so the failure is silent.

```yaml
nebariapp:
  routing:
    tls:
      enabled: true
    routes:
      - pathPrefix: /
        pathType: PathPrefix
```
:::

### `nebariapp.auth`

| Value | Default | Purpose |
|---|---|---|
| `auth.enabled` | `false` | Provision a Keycloak client. |
| `auth.provider` | `keycloak` | Identity provider. |
| `auth.provisionClient` | `true` | Operator creates the OIDC client and its Secret. |
| `auth.enforceAtGateway` | `false` | Kept off — Superset runs its own OAuth flow. |
| `auth.redirectURI` | `/oauth-authorized/keycloak` | Flask-AppBuilder's callback path. |
| `auth.scopes` | `openid, profile, email` | Requested scopes. |
| `auth.groups` | `[]` | Groups created in Keycloak. Empty admits every authenticated user. |

Enabling `auth` provisions the client; it does **not** configure Superset. The Python
config in `superset.configOverrides.oauth_config` and the `extraEnvRaw` wiring are what
make login work. See [Keycloak OAuth](/oauth/).

## `secretKey`

| Value | Default | Purpose |
|---|---|---|
| `secretKey.create` | `true` | Generate and manage the `SUPERSET_SECRET_KEY` Secret. |
| `secretKey.secretName` | `""` → `<release>-secret-key` | Override the Secret name. |

:::caution[Set `create: false` under Argo CD]
The chart preserves the key across upgrades with Helm's `lookup`, which Argo CD's
`helm template` rendering cannot support. Left at `true`, the key is regenerated on every
sync and every encrypted database password becomes unreadable. See
[Secret key](/secret-key/).
:::

## Overrides

| Value | Default |
|---|---|
| `nameOverride` | `""` |
| `fullnameOverride` | `""` |

These affect the `NebariApp` name and labels, not the upstream chart's service name. If you
set either, confirm `nebariapp.service.name` still points at a service that exists.

## Upstream values this chart sets

| Value | Set to | Why |
|---|---|---|
| `superset.service.type` / `.port` | `ClusterIP` / `8088` | Routing is the `NebariApp`'s job. |
| `superset.configOverrides.proxy_fix` | `ENABLE_PROXY_FIX`, `PROXY_FIX_CONFIG`, CSRF settings | Superset sits behind a proxy; without it, redirects and absolute URLs use the pod's own address. `WTF_CSRF_TIME_LIMIT = None` stops long-lived sessions from failing CSRF. |
| `superset.envFromSecrets` | `['{{ .Release.Name }}-secret-key']` | Injects the managed key. |
| `superset.postgresql.image.repository` | `bitnamilegacy/postgresql` | Upstream defaults point at removed Docker Hub tags. |
| `superset.redis.image.repository` | `bitnamilegacy/redis` | Same. |
| `superset.bootstrapScript` | installs `authlib` and `.[postgres]` | Required by the OAuth config and the PostgreSQL driver. |

:::caution[`bootstrapScript` is replaced wholesale, not merged]
Overriding it means carrying both installs forward. Dropping `authlib` breaks OAuth at
import; dropping `.[postgres]` breaks the metadata database connection.
:::

## Where to configure what

| To change | Set |
|---|---|
| Hostname, TLS, routing | `nebariapp.*` |
| Keycloak client and groups | `nebariapp.auth.*` |
| How Superset authenticates users | `superset.configOverrides.oauth_config` |
| OAuth credentials from the operator's Secret | `superset.extraEnvRaw` |
| Metadata database | `superset.postgresql.*` or `superset.supersetNode.connections.*` |
| Cache and Celery broker | `superset.redis.*` |
| Superset Python config | `superset.configOverrides.*` |
| Extra Python packages | `superset.bootstrapScript` |
| Replicas, resources, probes | upstream keys under `superset.*` |

## A Nebari values file

```yaml
nebariapp:
  enabled: true
  hostname: superset.example.com
  routing:
    tls: { enabled: true }
    routes:
      - pathPrefix: /
        pathType: PathPrefix
  auth:
    enabled: true
    provisionClient: true
    groups: [superset-admin, superset-user]
  gateway: internal
  landingPage:
    enabled: true
    displayName: "Apache Superset"
    category: "Data Science"

secretKey:
  create: false        # Argo CD

superset:
  postgresql:
    enabled: false
  supersetNode:
    connections:
      db_host: postgres.example.com
      db_port: "5432"
      db_user: superset
      db_name: superset
  configOverrides:
    oauth_config: |
      # see the Keycloak OAuth page
  extraEnvRaw:
    - name: OAUTH_CLIENT_ID
      valueFrom:
        secretKeyRef:
          name: superset-nebari-superset-oidc-client
          key: client-id
    # ... client-secret and issuer-url
```

## Inspecting

```bash
helm template superset chart --set nebariapp.enabled=true \
  --set nebariapp.hostname=superset.example.com | less

helm -n superset get values superset
helm -n superset get values superset --all
```

Redact before sharing — an inline `db_pass` shows up here.
