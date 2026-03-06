# StreamFusion VPN (Docker Image)

Poiché il tuo utente Github è stato shadowbannato da Render (motivo per cui scattava la richiesta della carta/Payment info come deterrente anti-spam da parte loro), il modo migliore per aggirarlo è fornire a Render (o Koyeb/servizi simili) un'immagine Docker precompilata caricata su **Docker Hub**, anziché dirigerli alla tua repository Github.

## Istruzioni (5 Minuti)

1. **Crea un account (se non ce l'hai) su Docker Hub**: https://hub.docker.com/
2. **Apri Docker Desktop** sul tuo PC per assicurarti che sia avviato (la spia in basso a sinistra in app deve essere verde).
3. Apri un terminale in questa cartella ed esegui il Login:
   `ash
   docker login
   `
4. Compila la tua immagine (sostituendo "tuonomeutente" con quello di Docker Hub):
   `ash
   docker build -t tuonomeutente/streamfusion-vpn:latest .
   `
5. Pusha l'immagine online:
   `ash
   docker push tuonomeutente/streamfusion-vpn:latest
   `
6. **Vai su Render o Koyeb**:
   - Crea un nuovo progetto ma scegli **"Deploy from Container Registry"** (o "Existing image" su Render).
   - Nel campo di ricerca immagine inserisci: 	uonomeutente/streamfusion-vpn:latest
   - Aggiungi le Environment Variables dal tuo file copiandole una ad una dalla VPN (WIREGUARD_PRIVATE_KEY, VPN_ENDPOINT_IP, ecc...).
   - **Deploy!**

Così salti a piè pari Github e i check sui token di terze parti, non farti scansionare i file dai bot bot-detection (tipo Hugging Face) e dai a Render un'app "In scatola" già chiusa e impenetrabile!
