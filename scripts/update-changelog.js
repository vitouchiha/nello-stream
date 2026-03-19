const fs = require('fs');
let c = fs.readFileSync('CHANGELOG.md', 'utf8');
const newInfo = \## [3.0.18] - 2026-03-09

### Fixed
- **Browserless Quota & Guardaserie Playback** - Disabilitato temporaneamente il fallback Browserless oneroso per i flussi SuperVideo (che consumava l'intera quota API a causa di fail continui su Cloudflare). Sostituito con un reindirizzamento al player nativo web-browser di Guardaserie, risolvendo i problemi di stream non riproducibile dovuti ai check di IP-lock originati da Browserless.
- **ToonItalia Search & Extraction** - Sistemata l'estrazione TV show di ToonItalia ottimizzando il matching RegEx dell'HTML degli episodi e introducendo la normalizzazione corretta delle chiavi in stringa minuscola per permettere il recupero della libreria serie tv.

---
\;
fs.writeFileSync('CHANGELOG.md', newInfo + c);

