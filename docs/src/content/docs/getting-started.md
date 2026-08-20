---
title: Getting started
description: Install the Nebari Superset Pack and reach the UI.
---

## Prerequisites

- Kubernetes and Helm 3.
- For the Nebari path: the
  [nebari-operator](https://github.com/nebari-dev/nebari-operator), Envoy Gateway,
  cert-manager with a cluster issuer, and a Keycloak realm.
- A StorageClass, if you use the bundled PostgreSQL and Redis.

No Nebari platform? Go to [Standalone deployment](/standalone/).

## Install on a Nebari cluster

The values files live in the repository, not in the published chart, so fetch the one you
want first. `-O` overwrites any file of that name in the current directory, so once you have
edited your copy, do not re-run the fetch:

```bash
helm repo add nebari-superset https://nebari-dev.github.io/helm-repository
helm repo update

curl -fsSLO https://raw.githubusercontent.com/nebari-dev/superset-pack/main/examples/nebari-values.yaml

kubectl create namespace superset
kubectl label namespace superset nebari.dev/managed=true --overwrite

helm upgrade --install superset nebari-superset/nebari-superset \
  -f nebari-values.yaml \
  -n superset
```

The namespace label is not optional — the operator ignores `NebariApp` resources in
unlabeled namespaces, silently.

`examples/nebari-values.yaml` is a starting point, not a drop-in. Before applying, change:

| Field | To |
|---|---|
| `nebariapp.hostname` | your FQDN |
| `superset.supersetNode.connections.*` | your external PostgreSQL, or switch to the bundled one |
| `superset.extraEnvRaw[].secretKeyRef.name` | `<release>-nebari-superset-oidc-client` for your release name |

And add a `routing` block — see below.

:::caution[Add `nebariapp.routing`]
The chart leaves `routing` unset by default, and the operator only creates an HTTPRoute
and a TLS certificate when it is present. Without it you get a `NebariApp` that reconciles
cleanly and a hostname that resolves to nothing.

```yaml
nebariapp:
  routing:
    tls:
      enabled: true
    routes:
      - pathPrefix: /
        pathType: PathPrefix
```

`examples/argocd-app.yaml` includes this block; `examples/nebari-values.yaml` does not.
:::

## What gets deployed

| Workload | From | Purpose |
|---|---|---|
| `superset` | upstream chart | Web UI and API, port `8088` |
| `superset-worker` | upstream chart | Celery worker for async queries |
| `superset-init-db` | upstream chart | Job: schema migration and admin bootstrap |
| `superset-postgresql` | upstream chart | Metadata store, when bundled |
| `superset-redis-master` | upstream chart | Cache and Celery broker. Superset connects via the `superset-redis-headless` Service, not this one. |
| `<release>-secret-key` | this chart | `SUPERSET_SECRET_KEY` |
| `<release>-nebari-superset` | this chart | `NebariApp` |

The `NebariApp` targets the service named after the **release** by default
(`nebariapp.service.name` falls back to `.Release.Name`). Override it if your release name
does not match the upstream chart's service name.

## Verify

```bash
kubectl -n superset get pods
kubectl -n superset get nebariapp,httproute,certificate

# The init job must complete before the UI works
kubectl -n superset get job superset-init-db
kubectl -n superset logs job/superset-init-db --tail=30
```

A `superset-init-db` job stuck in `Error` blocks everything else. It usually points at the
metadata database — wrong credentials, unreachable host, or a decryption failure from a
rotated [secret key](/secret-key/).

Then the app itself:

```bash
kubectl -n superset port-forward svc/superset 8088:8088
curl -sf http://localhost:8088/health && echo OK
```

## First login

With OAuth configured, open `https://superset.<your-domain>` and sign in through Keycloak.
The role you land in comes from `AUTH_ROLES_MAPPING` and your Keycloak group membership —
see [Keycloak OAuth](/oauth/).

Without OAuth, the upstream chart's bootstrap creates a local `admin` account. Change its
password immediately; the default is well known.

## Next

- Understand role mapping before you invite anyone: [Keycloak OAuth](/oauth/)
- Read [Secret key](/secret-key/) **before** deploying through Argo CD
- Move the metadata store off the bundled PostgreSQL for production:
  [Database and Redis](/database/)
