/**
 * Unified formatter per standardizzare le risposte dello Stream Engine.
 */

function formatForApi(streams) {
    if (!streams || streams.length === 0) {
        return {
            status: "success",
            data: [],
            message: "Nessun flusso disponibile per questo contenuto."
        };
    }

    return {
        status: "success",
        count: streams.length,
        data: streams
    };
}

function formatForUI(streams) {
    if (!streams || streams.length === 0) {
        return "<div class='no-streams'>Nessun flusso disponibile per questo contenuto.</div>";
    }

    const htmlParts = streams.map(s => `
        <div class="stream-card">
            <h4>${s.provider}</h4>
            <p><strong>Qualità:</strong> ${s.quality}</p>
            <p><strong>Lingua:</strong> ${s.audio_lang} ${s.subtitles && s.subtitles.length > 0 ? `(Sub: ${s.subtitles.join(', ')})` : ''}</p>
            <p><strong>Tipo:</strong> ${s.type}</p>
            <a href="${s.url}" target="_blank" class="play-btn">Guarda / Scarica</a>
        </div>
    `);

    return `<div class="streams-container">${htmlParts.join('')}</div>`;
}

function formatForMarkdown(streams) {
    if (!streams || streams.length === 0) {
        return "**Nessun flusso disponibile per questo contenuto.**";
    }

    const mdParts = streams.map(s => 
        `- [${s.provider}] ${s.quality} | 🗣 ${s.audio_lang} | 📝 Sub: ${s.subtitles.join(',') || 'N/A'} - [Link](${s.url})`
    );

    return `### Flussi disponibili\n\n${mdParts.join('\n')}`;
}

module.exports = {
    formatForApi,
    formatForUI,
    formatForMarkdown
};
