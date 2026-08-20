---
title: Secret key
description: How SUPERSET_SECRET_KEY is managed, why Argo CD rotates it, and how to recover.
---

Superset encrypts sensitive fields in its metadata database — database passwords and
`encrypted_extra` on every connection — with `SUPERSET_SECRET_KEY`. Change the key and that
data becomes unreadable. There is no recovery except clearing it and re-entering the
credentials.

## How the chart manages it

```yaml
secretKey:
  create: true          # default
  secretName: ""        # default: <release>-secret-key
```

With `create: true` the chart renders a Secret whose value is:

- the existing key, when Helm's `lookup` finds the Secret already in the cluster, or
- a fresh `randAlphaNum 64`, on first install.

The Secret carries `helm.sh/resource-policy: keep`, so `helm uninstall` leaves it behind
and a reinstall picks the same key back up. The upstream chart consumes it through
`envFromSecrets`.

On plain Helm this works exactly as intended.

## Why Argo CD breaks it

:::caution[Argo CD regenerates the key on every sync]
Argo CD's repo-server renders charts with `helm template`, which has no connection to the
Kubernetes API. Helm's `lookup` therefore returns empty **every time**, and the chart takes
the "first install" branch — generating a new random key on each sync.

Every previously encrypted field then fails to decrypt:
`ValueError: Invalid decryption key`.

This is [argo-cd#5202](https://github.com/argoproj/argo-cd/issues/5202), and it affects any
chart using `lookup`.
:::

Nothing warns you. The sync succeeds, the pods restart, and the failure appears the next
time Superset reads a stored credential — often as a broken `superset-init-db` job or a 500
when opening a dashboard.

## The fix: manage the Secret yourself

**1. Create it.**

```bash
SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")

kubectl create secret generic superset-secret-key \
  --namespace superset \
  --from-literal=SUPERSET_SECRET_KEY="$SECRET"
```

Or use whatever your cluster already has for secret material — sealed-secrets,
external-secrets, a cloud secret manager.

**2. Turn chart management off.**

```yaml
secretKey:
  create: false
```

The upstream chart still reads `<release>-secret-key` through `envFromSecrets`, so name the
Secret to match, or set `secretKey.secretName` and reference that name in
`superset.envFromSecrets`.

**3. Migrating an existing deployment.** If you are switching from `create: true` with a
live key, annotate the Secret first so Argo CD does not prune it as extraneous:

```bash
kubectl annotate secret superset-secret-key -n superset \
  argocd.argoproj.io/compare-options=IgnoreExtraneous
```

Then change the values and sync. Skipping this step deletes the key you were trying to
preserve.

## Recovery after a rotation

If the key has already changed and Superset is throwing decryption errors, the encrypted
fields are unrecoverable. Clear them so Superset can function again — connection names and
URIs are preserved; passwords and `encrypted_extra` are wiped and must be re-entered in the
UI.

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

:::caution[This is destructive]
Every stored database password is erased. Have the credentials on hand before running it,
and back up the metadata database first if you can.
:::

If the init job is wedged in `Error`, delete it so it can be recreated:

```bash
kubectl delete job superset-init-db -n superset
```

Then fix the underlying cause — set `secretKey.create: false` and supply a stable Secret —
before syncing again, or the next sync rotates the key once more.

## Verifying stability

The key should be identical before and after a sync:

```bash
kubectl -n superset get secret superset-secret-key \
  -o jsonpath='{.data.SUPERSET_SECRET_KEY}' | sha256sum
```

Run it, sync, run it again. Different digests under Argo CD mean the chart is still
generating the key.

## Rotating deliberately

If you must rotate — a leaked key, for instance — clear the encrypted fields **first**,
while the old key still works and the data is readable enough to export:

1. Record every database connection's credentials.
2. Run the clearing command above.
3. Replace the Secret.
4. Restart Superset and the worker.
5. Re-enter the credentials in the UI.

Doing it in the other order leaves you with the same wipe and no record of what to restore.
