---
title: FlareSolverr
emoji: 🔓
sdk: docker
app_port: 7860
pinned: false
---

# FlareSolverr

Proxy server per aggirare la protezione Cloudflare (usato da StreamFusion Mail).

## API

`POST /v1`

```json
{
  "cmd": "request.get",
  "url": "https://kisskh.co",
  "maxTimeout": 60000
}
```

## Note
- Porta esposta: **7860** (richiesto da HF Spaces)
- `LOG_LEVEL` default: `info`
- `CAPTCHA_SOLVER` default: `none` (non serve per bypass CF base)
