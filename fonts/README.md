# fonts/

Licensed Lineto Replica files live here — they are deliberately NOT
committed (a public repo must not redistribute them; see .gitignore).

The pages ask for:

- `Replica_Regular.ttf`  → family 'Replica' 400
- `Replica_Bold.ttf`     → family 'Replica' 700
- `ReplicaMonoStd.otf`   → family 'Replica Mono' 400

Drop the trial files (or, once Kaizen's web license lands, the woff2 set —
update the @font-face `src`/`format` in white.html accordingly) into this
folder on any deploy. The published artifact pages carry the fonts inlined
as data URIs instead, injected at publish time.
