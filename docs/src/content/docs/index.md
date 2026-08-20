---
title: Introduction
description: "Apache Superset dashboards and SQL exploration with Keycloak OAuth and NebariApp routing. Also installs standalone on non-Nebari clusters."
---

The Nebari Superset Pack wraps the upstream
[Apache Superset](https://superset.apache.org/) Helm chart for
[Nebari](https://nebari.dev), adding a `NebariApp` for routing and TLS, Keycloak OAuth with
role mapping, and a managed `SUPERSET_SECRET_KEY`.

Superset 6.1.0, via the upstream chart 0.17.2.

```
  browser ──► Envoy Gateway ──► Superset :8088 ──► PostgreSQL  (metadata)
                (routing            │                └─────► Redis  (cache, celery)
                 + TLS)             │
                                 OAuth ──► Keycloak
```

Note where authentication happens. Superset runs the OAuth flow **itself**, through
Flask-AppBuilder, so `auth.enforceAtGateway` is `false` and the gateway only routes. That
is what makes Keycloak roles map onto Superset roles — a gateway-enforced login would
authenticate the user and tell Superset nothing about who they are. See
[Keycloak OAuth](/oauth/).

## What the pack adds

- **A `NebariApp`** producing an HTTPRoute and a TLS certificate, and provisioning a
  Keycloak OIDC client whose credentials land in a Secret the Superset config reads.
- **A managed `SUPERSET_SECRET_KEY`**, generated on first install and preserved across
  upgrades — with an important exception under Argo CD, below.
- **Working defaults for the upstream chart**: `ENABLE_PROXY_FIX` so Superset builds correct
  URLs behind the gateway, a bootstrap script installing `authlib` and the Postgres extras,
  and image overrides that keep the bundled PostgreSQL and Redis pullable.
- **Standalone mode** for clusters with no Nebari platform at all.

## Two things to get right first

Both are silent failures, and both have a page.

- **Argo CD rotates the secret key on every sync** unless you manage the Secret yourself.
  When that happens every encrypted database password in Superset's metadata store becomes
  unreadable. See [Secret key](/secret-key/).
- **`nebariapp.routing` must be set explicitly.** Without it the operator creates no
  HTTPRoute and no certificate — the `NebariApp` exists and nothing is reachable. See
  [Deploying on Nebari](/deployment/#routing-is-not-optional).

## In this guide

- **[Getting started](/getting-started/)** — install on a Nebari cluster and reach Superset
- **[Deploying on Nebari](/deployment/)** — Helm and Argo CD, routing, gateway, landing page
- **[Standalone deployment](/standalone/)** — non-Nebari clusters
- **[Local development](/local-development/)** — the kind stack in `dev/`

## Guides

- **[Keycloak OAuth](/oauth/)** — the security manager, role mapping, and the OIDC secret
- **[Secret key](/secret-key/)** — how it is managed, why Argo CD breaks it, and recovery
- **[Database and Redis](/database/)** — bundled versus external, and the image overrides

## Reference

- **[Configuration](/configuration/)** — values this chart owns, and the upstream
  pass-through
