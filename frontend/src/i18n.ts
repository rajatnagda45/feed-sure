import { Lang } from "./api";

const strings = {
  en: {
    readyQuestion: "Is food waste ready for collection?",
    ready: "Ready",
    notReady: "Not ready",
    date: "Collection date",
    quantity: "Estimated quantity",
    source: "How was it measured?",
    scale: "Scale",
    estimate: "Estimate",
    window: "Pickup window",
    reason: "Short reason (optional)",
    save: "Save readiness",
    saving: "Saving…",
    saved: "Readiness saved",
    records: "Collection records",
    noRecords: "No collection records yet.",
    retry: "Try again",
    edit: "Edit readiness",
  },
  hi: {
    readyQuestion: "क्या खाद्य अपशिष्ट संग्रह के लिए तैयार है?",
    ready: "तैयार",
    notReady: "तैयार नहीं",
    date: "संग्रह की तारीख",
    quantity: "अनुमानित मात्रा",
    source: "मात्रा कैसे मापी गई?",
    scale: "तराजू",
    estimate: "अनुमान",
    window: "संग्रह का समय",
    reason: "संक्षिप्त कारण (वैकल्पिक)",
    save: "तैयारी सहेजें",
    saving: "सहेजा जा रहा है…",
    saved: "तैयारी सहेजी गई",
    records: "संग्रह रिकॉर्ड",
    noRecords: "अभी कोई संग्रह रिकॉर्ड नहीं है।",
    retry: "फिर कोशिश करें",
    edit: "तैयारी बदलें",
  },
} as const;

export function t(lang: Lang) {
  return strings[lang];
}
