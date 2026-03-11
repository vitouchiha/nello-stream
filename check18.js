
const cleanText = '01 – Inizia il grande viaggio – <a';
console.log('seasonMatch:', cleanText.match(/(?:stagione|season|s)?[\s\-]*(\d+)[\s]*[x\-][\s]*(?:episodio|episode|ep|e)?[\s]*(\d+)/i));
console.log('anyNumberMatch:', cleanText.match(/(?:^|\s)(\d{1,3})(?:\s|-|–|$)/));

