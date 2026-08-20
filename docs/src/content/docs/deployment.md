---
title: Deploying on Nebari
description: Helm and Argo CD, the routing block, gateway selection, and the landing-page tile.
---

## The NebariApp

With `nebariapp.enabled: true` the chart renders a `NebariApp` that the operator reconciles
into an HTTPRoute, a TLS certificate, and — when auth is on — a Keycloak OIDC client.

```yaml
nebariapp:
  enabled: true
  hostname: superset.example.com
  routing:
    tls:
      enabled: true
    routes:
      - pathPrefix: /
        pathType: PathPrefix
  auth:
    enabled: true
    provisionClient: true
    enforceAtGateway: false
    redirectURI: "/oauth-authorized/keycloak"
    scopes: [openid, profile, email]
  gateway: public
```

`hostname` is required; the chart fails the render without it.

## Routing is not optional

The chart's default leaves `routing` commented out, and the operator treats its absence as
"do not create routes":

> The `routing` section must be included for the operator to create HTTPRoutes and TLS
> certificates. Without it, no route or certificate will be provisioned.

This fails quietly. `kubectl get nebariapp` looks fine; there is simply no HTTPRoute and no
Certificate to find. If the hostname does not resolve to Superset, check for those two
objects before anything else:

```bash
kubectl -n superset get httproute,certificate
```

:::caution[`examples/nebari-values.yaml` omits the routing block]
`examples/argocd-app.yaml` includes it. Copy the block from there when starting from the
Helm example.
:::

## Gateway selection

```yaml
nebariapp:
  gateway: public    # or: internal
```

`public` attaches to the cluster's internet-facing gateway; `internal` keeps Superset
reachable only from inside the network perimeter. It is a sensible default for a BI tool
holding warehouse credentials — decide deliberately rather than inheriting `public`.

## Argo CD

A complete manifest is in
[`examples/argocd-app.yaml`](https://github.com/nebari-dev/superset-pack/blob/main/examples/argocd-app.yaml).

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: superset
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/nebari-dev/nebari-superset-pack
    targetRevision: v0.3.0
    path: chart
    helm:
      values: |
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
            enforceAtGateway: false
            redirectURI: "/oauth-authorized/keycloak"
            groups: [superset-admin, superset-user, superset-public]
        secretKey:
          create: false          # see below
  destination:
    server: https://kubernetes.default.svc
    namespace: superset
  syncPolicy:
    managedNamespaceMetadata:
      labels:
        nebari.dev/managed: "true"
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
      - SkipDryRunOnMissingResource=true
```

:::caution[Set `secretKey.create: false` under Argo CD]
Argo CD renders charts with `helm template`, which cannot reach the Kubernetes API, so the
chart's `lookup` returns nothing and it generates a **new** `SUPERSET_SECRET_KEY` on every
sync. Every encrypted database password in Superset's metadata store then fails to decrypt.

Create the Secret yourself and turn chart management off. Full procedure, including
recovery if it has already happened, in [Secret key](/secret-key/).
:::

Two other things in that manifest are worth naming:

- **`managedNamespaceMetadata`** applies `nebari.dev/managed: "true"`, which is what makes
  the operator act on the `NebariApp` at all.
- **`SkipDryRunOnMissingResource=true`** lets the first sync proceed before the `NebariApp`
  CRD is registered, which matters when the operator is installed by the same bootstrap.

The example pins `targetRevision: v0.3.0` and sources `path: chart` from git. Pointing at
the published Helm repository instead is equally valid; either way, keep the revision
pinned.

## Keycloak groups

Groups listed in `auth.groups` are created in the realm by the operator:

```yaml
nebariapp:
  auth:
    groups:
      - superset-admin
      - superset-user
      - superset-public
```

Those names are not arbitrary — they are the keys in the `AUTH_ROLES_MAPPING` block that
maps Keycloak group membership onto Superset roles. Change one side and change the other.
See [Keycloak OAuth](/oauth/).

An empty `groups` list means any authenticated realm user can log in, landing in the role
named by `AUTH_USER_REGISTRATION_ROLE` (`Gamma` in the examples).

## Landing-page tile

Commented out in the chart's defaults; the `argocd-app.yaml` example shows the full block:

```yaml
nebariapp:
  landingPage:
    enabled: true
    displayName: "Apache Superset"
    description: "Data exploration and visualization platform"
    icon: "https://superset.apache.org/img/superset-logo-horiz.svg"
    category: "Data Science"
    priority: 10
    healthCheck:
      enabled: true
      path: "/health"
      intervalSeconds: 30
      timeoutSeconds: 5
```

## Verifying

```bash
kubectl -n superset get nebariapp -o yaml
kubectl -n superset get httproute,certificate,securitypolicy
kubectl -n superset get secret superset-nebari-superset-oidc-client
kubectl get namespace superset -o jsonpath='{.metadata.labels}'
```

With `enforceAtGateway: false` there should be **no** `SecurityPolicy` — Superset owns the
login. Seeing one means gateway enforcement got switched on, which double-authenticates and
breaks the OAuth callback.

## Upgrading

Bump the chart version and sync. Two cautions:

- The `superset-init-db` job runs schema migrations. They are one-way; snapshot the
  metadata database before a major Superset version bump.
- Confirm `secretKey.create` is still `false` under Argo CD after any values refactor. A
  reintroduced `true` rotates the key on the next sync.
