---
title: Standalone deployment
description: Running the pack on a cluster with no Nebari platform.
---

With `nebariapp.enabled: false` — the chart's default — no `NebariApp` is rendered, so the
pack needs no operator, gateway, cert-manager, or Keycloak. It is the upstream Superset
chart plus a managed secret key and working image defaults.

## Install

```bash
helm repo add nebari-superset https://nebari-dev.github.io/helm-repository
helm repo update

helm upgrade --install superset nebari-superset/nebari-superset \
  -f examples/standalone-values.yaml \
  -n superset --create-namespace
```

[`examples/standalone-values.yaml`](https://github.com/nebari-dev/superset-pack/blob/main/examples/standalone-values.yaml):

```yaml
nebariapp:
  enabled: false

superset:
  configOverrides:
    proxy_fix: |
      ENABLE_PROXY_FIX = True
      PROXY_FIX_CONFIG = {'x_for': 1, 'x_proto': 1, 'x_host': 1, 'x_port': 1, 'x_prefix': 1}
      WTF_CSRF_ENABLED = True
      WTF_CSRF_TIME_LIMIT = None

  extraSecretEnv:
    SUPERSET_SECRET_KEY: CHANGE-ME-generate-with-openssl-rand-base64-42

  postgresql:
    enabled: true
  redis:
    enabled: true

  bootstrapScript: |
    #!/bin/bash
    uv pip install authlib ".[postgres]" && \
    if [ ! -f ~/bootstrap ]; then echo "Running Superset with uid {{ .Values.runAsUser }}" > ~/bootstrap; fi

  service:
    type: ClusterIP
    port: 8088
```

:::caution[Change the secret key before installing]
The example ships a literal placeholder. Generate a real one:

```bash
openssl rand -base64 42
```

The chart's own `secretKey.create` (default `true`) also produces a Secret. Setting
`extraSecretEnv.SUPERSET_SECRET_KEY` as the example does gives Superset two sources for the
same variable — pick one. Either keep the chart-managed Secret and drop the
`extraSecretEnv` line, or set `secretKey.create: false` and keep the explicit value. See
[Secret key](/secret-key/).
:::

## Access

```bash
kubectl -n superset port-forward svc/superset 8088:8088
```

Open `http://localhost:8088` and sign in with the local `admin` account the upstream
chart's init job creates. **Change that password immediately** — the default is published
in the upstream chart.

For something more permanent, the upstream chart has an `ingress` block, or switch the
service to `LoadBalancer`:

```yaml
superset:
  service:
    type: LoadBalancer
```

Either way, keep `ENABLE_PROXY_FIX` on so Superset builds correct absolute URLs from the
forwarded headers.

## Authentication

Standalone means Superset's local user database. Users, roles, and passwords are managed
in the Superset UI, and nothing outside Superset validates them.

The pack does not configure any external identity provider outside the Nebari path. If you
have a Keycloak (or any OIDC provider) without the rest of the Nebari platform, the
`oauth_config` block from [Keycloak OAuth](/oauth/) works standalone too — supply
`OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, and `OAUTH_SERVER_METADATA_URL` from your own
Secret rather than the operator-created one.

## Production notes

The standalone example is a working deployment, not a hardened one:

- **The bundled PostgreSQL uses a legacy Bitnami mirror.** Fine to evaluate; run an external
  database for anything durable. See [Database and Redis](/database/).
- **No TLS.** Terminate it at your ingress.
- **No backups.** Nothing in the chart backs up the metadata database.
- **The local `admin` account.** Rotate the password and create per-person accounts.

## Trying it locally

`dev/` has a `make up-standalone` target that creates a kind cluster and deploys this
configuration in one step. See [Local development](/local-development/).
