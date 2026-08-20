---
title: Local development
description: The kind-based dev stack in dev/ — full Nebari or standalone.
---

`dev/` builds a kind cluster with the full Nebari platform so the `NebariApp` path can be
exercised locally, not just the chart.

## Prerequisites

kind, kubectl, helm, docker, and git.

## Two stacks

```bash
cd dev

make up             # kind + MetalLB + Envoy Gateway + cert-manager + Keycloak
                    # + nebari-operator + Superset with NebariApp
make up-standalone  # kind + Superset only
make down           # delete the cluster
```

`make up` finishes by printing the URL — `https://superset.localhost` by default — and the
Keycloak credentials, `admin` / `nebari-admin`.

`make up-standalone` skips the platform entirely; reach Superset with:

```bash
kubectl port-forward svc/superset-superset 8088:8088 -n superset
```

## What `make up` actually does

| Target | Step |
|---|---|
| `cluster` | Creates the kind cluster, installs MetalLB, and derives an IP pool from the `kind` Docker network |
| `deps` | Clones nebari-operator, runs its `dev/scripts/services/install.sh` (Envoy Gateway, cert-manager, Keycloak) and `keycloak/setup.sh`, then installs the operator release |
| `label-ns` | Creates the namespace and labels it `nebari.dev/managed=true` |
| `deploy` | Installs the chart from `../chart` with the dev values |
| `update-hosts` | Appends `127.0.0.1 superset.localhost` to `/etc/hosts` — **uses sudo** |

The MetalLB pool is computed from the Docker network at runtime rather than hardcoded,
which is what lets it work across machines.

`update-hosts` is the one step that touches your machine outside Docker. It is idempotent —
it greps before appending — but it does prompt for sudo.

## Overridable variables

| Variable | Default |
|---|---|
| `CLUSTER_NAME` | `superset-dev` |
| `NAMESPACE` | `superset` |
| `HOSTNAME` | `superset.localhost` |
| `OPERATOR_REF` | `main` |

```bash
make up CLUSTER_NAME=my-superset HOSTNAME=superset.test
```

`OPERATOR_REF` is worth knowing about: `deps` clones the operator at that ref and runs its
service-install scripts, so a breaking change on the operator's `main` shows up here first.
Pin it to a release tag when you want a stable local stack.

## Inspecting and iterating

```bash
make test    # pods, services, NebariApp, HTTPRoute, SecurityPolicy
make logs    # tail Superset logs
```

`make test` prints the `SecurityPolicy` check too. With the pack's default
`enforceAtGateway: false` there should be **none** — the target reports "No SecurityPolicy
found", which is the correct result, not a failure. Superset owns its own OAuth flow; see
[Keycloak OAuth](/oauth/).

After a chart edit, re-run the deploy step:

```bash
make deploy
```

The cluster and platform stay up, so the loop is a `helm upgrade`, not a rebuild.

## Cleaning up

```bash
make down
```

Deletes the kind cluster and removes the cloned operator from `/tmp`. The `/etc/hosts` line
is left behind — remove it by hand if it bothers you.

## What local development cannot tell you

- **Real TLS.** The dev stack issues certificates locally; a public ACME issuer behaves
  differently, and DNS validation is not exercised at all.
- **The Argo CD secret-key rotation.** It only appears under Argo CD, and the dev stack
  installs with Helm. Read [Secret key](/secret-key/) before deploying through GitOps.
- **Your identity provider.** The dev Keycloak has a seeded realm; group and role names in
  a real realm will differ, and role mapping is where most OAuth issues live.

## Docs site

```bash
cd docs
npm ci
npm run dev     # hot reload at http://localhost:4321
npm run build   # static build into docs/dist/
npm test        # unit tests
```

Pages live in `docs/src/content/docs/`; the sidebar is in `docs/astro.config.mjs`. Merges to
`main` publish to [packs.nebari.dev/superset-pack/](https://packs.nebari.dev/superset-pack/),
and pull requests touching `docs/` get a preview URL posted as a comment.
