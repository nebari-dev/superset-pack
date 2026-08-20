---
title: Database and Redis
description: The metadata store and cache — bundled versus external, and the image overrides.
---

Superset needs two stateful dependencies:

| | Holds | Losing it means |
|---|---|---|
| **PostgreSQL** | dashboards, charts, saved queries, users, roles, database connections | everything is gone |
| **Redis** | query result cache and the Celery broker | async queries stop; nothing is lost permanently |

Both are bundled subcharts of the upstream Superset chart, enabled by default.

## The image overrides

```yaml
superset:
  postgresql:
    enabled: true
    image:
      repository: bitnamilegacy/postgresql
  redis:
    enabled: true
    image:
      repository: bitnamilegacy/redis
```

The upstream chart's defaults point at Bitnami image tags that were removed from Docker
Hub, so a stock install fails to pull. `bitnamilegacy/*` mirrors retain the older versions.

:::caution[Legacy mirrors are a stopgap]
They are not the ideal long-term base for a production metadata store. For anything
durable, run PostgreSQL externally — a managed instance or an operator-run cluster you
already back up.
:::

## External PostgreSQL

```yaml
superset:
  postgresql:
    enabled: false
  supersetNode:
    connections:
      db_host: postgres.example.com
      db_port: "5432"
      db_user: superset
      db_pass: changeme
      db_name: superset
```

:::caution[`db_pass` in values means a password in git]
`examples/nebari-values.yaml` shows it inline and says so. Use the upstream chart's
`extraSecretEnv` or an existing-secret reference instead, and check the
[upstream values](https://github.com/apache/superset/blob/master/helm/superset/values.yaml)
for the exact key names in the chart version you are running.
:::

The database must exist and the user must own it before the `superset-init-db` job runs —
the job migrates a schema, it does not create the database.

## Sizing

The metadata database is small: dashboard definitions, chart configs, and query history are
rows, not data. It grows with usage rather than with the size of the warehouses Superset
queries. Query *results* go to Redis and to the browser, not into PostgreSQL.

The one thing that does grow is the query log, if async queries are heavy. Watch table
sizes rather than assuming a fixed ceiling.

## Redis

The bundled Redis is fine for most deployments: an empty cache costs latency, not
correctness, and the Celery broker only holds in-flight tasks.

```yaml
superset:
  redis:
    enabled: false
    # then point the upstream chart's connection settings at your own instance
```

Disable it only if you have an external Redis you would rather operate. Disabling it
*without* providing a replacement breaks async query execution.

## Backups

Back up the metadata database. Nothing else in this deployment holds durable state — Redis
is a cache, and Superset stores no files.

```bash
kubectl exec -n superset statefulset/superset-postgresql -- \
  pg_dump -U superset superset > superset-backup.sql
```

Two things to know about restoring:

- **The dump is worthless without the matching `SUPERSET_SECRET_KEY`.** Encrypted database
  passwords in the dump can only be decrypted by the key that wrote them. Back up the
  Secret alongside the database — see [Secret key](/secret-key/).
- **Schema version must match.** A dump from an older Superset restored under a newer one
  needs the init job's migrations to run; the reverse does not work at all.

On a Nebari cluster with
[longhorn-backup-pack](https://packs.nebari.dev/longhorn-backup-pack/), the PostgreSQL PVC
is covered by the cluster-wide schedule if it sits on the default StorageClass. Confirm
rather than assume:

```bash
kubectl -n longhorn-system get volumes.longhorn.io \
  -l recurring-job-group.longhorn.io/default=enabled
```

A volume-level snapshot of a running database is crash-consistent, not
application-consistent. It will almost always replay cleanly, but a `pg_dump` before a
migration is the stronger guarantee.

## The bootstrap script

```yaml
superset:
  bootstrapScript: |
    #!/bin/bash
    uv pip install authlib ".[postgres]" && \
    if [ ! -f ~/bootstrap ]; then echo "Running Superset with uid {{ .Values.runAsUser }}" > ~/bootstrap; fi
```

It runs in the Superset container before startup and installs two things the image does not
carry: `authlib`, required by the OAuth provider config, and the `postgres` extras for the
PostgreSQL driver.

:::caution[Overriding `bootstrapScript` replaces it entirely]
Adding your own packages means keeping these two installs in your version. Drop `authlib`
and [OAuth](/oauth/) fails at import; drop `.[postgres]` and Superset cannot reach its
metadata database.
:::

The install runs at container start, so it costs startup time and needs network access to
PyPI on every pod restart. In an air-gapped cluster, bake a custom image instead.

## Connecting data sources

Warehouses users query are added in the Superset UI, not in the chart. Each needs its
driver present in the image — the bootstrap script installs the PostgreSQL extras only.
Other databases mean extending the script or building an image with the drivers included.

Credentials entered in the UI are encrypted with `SUPERSET_SECRET_KEY` in the metadata
database, which is exactly the data a key rotation destroys.
