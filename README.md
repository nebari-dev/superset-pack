# nebari-superset

A [Nebari](https://nebari.dev) Software Pack for [Apache Superset](https://superset.apache.org/).

Wraps the upstream Apache Superset Helm chart with:
- **NebariApp CRD** for routing, TLS, and gateway authentication on Nebari clusters
- **Keycloak OAuth** integration with role-based access control
- **Standalone mode** for non-Nebari Kubernetes clusters

## Quick Start

### On a Nebari Cluster

```bash
helm repo add nebari-superset https://nebari-dev.github.io/helm-repository
helm repo update

# Label the namespace
kubectl label namespace superset nebari.dev/managed=true --overwrite

# Deploy
helm upgrade --install superset nebari-superset/nebari-superset \
  -f examples/nebari-values.yaml \
  -n superset --create-namespace
```

See [examples/nebari-values.yaml](examples/nebari-values.yaml) for configuration details.

### Standalone (non-Nebari)

```bash
helm repo add nebari-superset https://nebari-dev.github.io/helm-repository
helm repo update

helm upgrade --install superset nebari-superset/nebari-superset \
  -f examples/standalone-values.yaml \
  -n superset --create-namespace
```

See [examples/standalone-values.yaml](examples/standalone-values.yaml) for configuration details.

### ArgoCD

See [examples/argocd-app.yaml](examples/argocd-app.yaml) for an ArgoCD Application example.

## Configuration

### NebariApp CRD

When `nebariapp.enabled: true`, the chart creates a NebariApp custom resource that the nebari-operator reconciles into:
- HTTPRoute for traffic routing
- TLS certificate
- (Optional) Keycloak OIDC client and Envoy SecurityPolicy

| Value | Description | Default |
|-------|-------------|---------|
| `nebariapp.enabled` | Create NebariApp resource | `false` |
| `nebariapp.hostname` | FQDN for the application | `""` (required when enabled) |
| `nebariapp.routing.tls.enabled` | Provision TLS certificate and HTTPS listener | `true` (when routing is set) |
| `nebariapp.routing.routes` | Path-based routing rules | `[]` |
| `nebariapp.auth.enabled` | Enable gateway auth | `false` |
| `nebariapp.auth.provisionClient` | Auto-provision Keycloak client | `true` |
| `nebariapp.auth.scopes` | OAuth scopes | `[openid, profile, email]` |
| `nebariapp.auth.groups` | Restrict to groups | `[]` |
| `nebariapp.gateway` | Gateway type | `public` |

**Important:** The `routing` section must be included for the operator to create HTTPRoutes and TLS certificates. Without it, no route or certificate will be provisioned.

### OAuth / Keycloak

OAuth is configured via `superset.configOverrides.oauth_config` in your values file. See [examples/nebari-values.yaml](examples/nebari-values.yaml) for a complete Keycloak configuration including:
- Custom SecurityManager for role mapping
- OAuth provider configuration
- Role mapping (Keycloak roles to Superset roles)

On Nebari clusters, the nebari-operator creates an OIDC client secret (`<release>-nebari-superset-oidc-client`) containing:
- `client-id` - the OIDC client ID
- `client-secret` - the client secret
- `issuer-url` - the Keycloak issuer URL

Reference this secret via `superset.extraEnvRaw` to inject credentials into the OAuth config.

### Secret Key

Superset requires a `SUPERSET_SECRET_KEY` for encrypting sensitive fields (database passwords, `encrypted_extra`) in its metadata database. By default (`secretKey.create: true`), the chart auto-generates a key on first install and uses Helm's `lookup` function to preserve it across upgrades.

| Value | Description | Default |
|-------|-------------|---------|
| `secretKey.create` | Auto-generate and manage the Secret | `true` |
| `secretKey.secretName` | Override the Secret name | `<release>-secret-key` |

#### ArgoCD: Manual Secret Management Required

**ArgoCD does not support Helm's `lookup` function.** ArgoCD's repo-server renders charts using `helm template`, which has no connection to the Kubernetes API — so `lookup` always returns empty. This causes the chart to generate a new random key on every sync, silently rotating the `SUPERSET_SECRET_KEY` and making all previously encrypted data unreadable (`ValueError: Invalid decryption key`).

See https://github.com/argoproj/argo-cd/issues/5202 for details.

When deploying with ArgoCD, manage the Secret manually:

**1. Create the Secret:**

```bash
SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")

kubectl create secret generic superset-secret-key \
  --namespace superset \
  --from-literal=SUPERSET_SECRET_KEY="$SECRET"
```

**2. Disable chart-managed Secret in your values:**

```yaml
secretKey:
  create: false
```

If you are switching an existing deployment from `create: true` to `create: false`, first annotate the existing Secret so ArgoCD does not prune it:

```bash
kubectl annotate secret <release>-secret-key -n superset \
  argocd.argoproj.io/compare-options=IgnoreExtraneous
```

Then update the values and let ArgoCD sync.

#### Recovery

If the key has already been rotated and Superset shows decryption errors, clear the undecryptable fields from the metadata database. This preserves database connections (names, URIs) but removes encrypted passwords and extras — re-enter them in the Superset UI afterward.

```bash
kubectl exec -n superset deploy/superset -- python3 -c "
import os
os.environ.setdefault('SUPERSET_CONFIG_PATH', '/app/pythonpath/superset_config.py')
from superset.app import create_app
app = create_app()
with app.app_context():
    from superset import db
    result = db.session.execute(db.text('UPDATE dbs SET encrypted_extra = NULL, password = NULL WHERE encrypted_extra IS NOT NULL OR password IS NOT NULL'))
    db.session.commit()
    print(f'Cleared encrypted fields on {result.rowcount} database connections')
"
```

If the `superset-init-db` job is stuck in Error, delete it so ArgoCD can recreate it:

```bash
kubectl delete job superset-init-db -n superset
```

### Upstream Superset

All values under `superset.*` pass through to the [upstream Apache Superset Helm chart](https://github.com/apache/superset/tree/master/helm/superset). See the upstream chart's [values.yaml](https://github.com/apache/superset/blob/master/helm/superset/values.yaml) for all available options.

## Local Development

```bash
cd dev

# Full Nebari stack
make up

# Standalone mode
make up-standalone

# Tear down
make down
```

See [dev/Makefile](dev/Makefile) for all available targets.

## Documentation

The docs site lives in [`docs/`](docs/) and is built with [Astro](https://astro.build) +
[Starlight](https://starlight.astro.build) using the shared `@nebari/starlight` theme. It
deploys to [packs.nebari.dev/superset-pack/](https://packs.nebari.dev/superset-pack/) on
every merge to `main`; pull requests that touch `docs/` get a preview URL posted as a
comment.

```bash
cd docs
npm ci
npm run dev     # dev server with hot reload at http://localhost:4321
npm run build   # static build into docs/dist/
npm test        # unit tests
```

Pages live in `docs/src/content/docs/` - each `.md` or `.mdx` file becomes a page, and the
sidebar is configured in `docs/astro.config.mjs`. See [`docs/README.md`](docs/README.md) for
details.

## License

Apache License 2.0 - see [LICENSE](LICENSE).
