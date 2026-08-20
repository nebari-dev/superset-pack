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

`make up` finishes by printing the URL, `https://superset.localhost` by default, and the
Keycloak credentials, `admin` / `nebari-admin`.

:::caution[`make up` does not set `nebariapp.routing`, so that URL does not resolve]
The `deploy` target sets `nebariapp.enabled`, `hostname`, and `auth.enabled`, and no
routing keys. Without them the operator creates no HTTPRoute and no certificate, per
[Deploying on Nebari](/deployment/#routing-is-not-optional), so the dev stack exercises the
whole `NebariApp` path except routing.

Adding the routing flags to the `helm upgrade` in `dev/Makefile`'s `deploy` target gets you
an HTTPRoute, though not a valid certificate (see
[below](#what-local-development-cannot-tell-you)):

```
	--set nebariapp.routing.tls.enabled=true \
	--set 'nebariapp.routing.routes[0].pathPrefix=/' \
	--set 'nebariapp.routing.routes[0].pathType=PathPrefix' \
```

Keep the trailing backslash on the last line: the recipe continues with the
`superset.bootstrapScript` override and `--wait`.

For a working local loop, use `kubectl port-forward svc/superset 8088:8088 -n superset` and
ignore the printed URL.
:::

`make up-standalone` skips the platform entirely; reach Superset with:

```bash
kubectl port-forward svc/superset 8088:8088 -n superset
```

The service is named after the release, and because the release name `superset` already
contains the upstream chart name the two do not get concatenated. `make up-standalone`
prints `svc/superset-superset`, which does not exist.

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
`enforceAtGateway: false` there should be **none**: the target reports "No SecurityPolicy
found", which is the correct result, not a failure. Superset owns its own OAuth flow; see
[Keycloak OAuth](/oauth/).

Its `HTTPRoute` check comes back empty for the same reason the printed URL does not work,
so treat that as expected unless you added the routing flags above. The `NebariApp` itself
records why:

```bash
kubectl -n superset get nebariapp -o json \
  | jq '.items[] | {name: .metadata.name, conditions: .status.conditions}'
```

Look for `RoutingReady: False` with reason `RoutingNotConfigured`.

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

- **TLS.** The dev stack never issues a certificate for Superset. The operator only creates
  one when it is started with `TLS_CLUSTER_ISSUER_NAME` set, and the dev manifests set only
  the `KEYCLOAK_*` variables, so TLS falls back to the shared gateway listener. That
  listener's cert covers `*.nebari.local`, which does not match the default
  `superset.localhost`. Certificate issuance and ACME DNS validation are not exercised here
  at all.
- **The Argo CD secret-key rotation.** It only appears under Argo CD, and the dev stack
  installs with Helm. Read [Secret key](/secret-key/) before deploying through GitOps.
- **Your identity provider.** The dev Keycloak has a seeded realm; group and role names in
  a real realm will differ, and role mapping is where most OAuth issues live.

## Docs site

Pages live in `docs/src/content/docs/`; the sidebar is in `docs/astro.config.mjs`. Merges to
`main` publish to [packs.nebari.dev/superset-pack/](https://packs.nebari.dev/superset-pack/),
and pull requests touching `docs/` get a preview URL posted as a comment.

```bash
cd docs
npm ci
npm run dev     # hot reload at http://localhost:4321
```

Before pushing, run what CI runs:

```bash
npm test && npm run build
bash ../scripts/check-links.sh
```

[`docs/README.md`](https://github.com/nebari-dev/superset-pack/blob/main/docs/README.md) has
the rest, including `npm run preview` and checking links against the production base path.
