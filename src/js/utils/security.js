export const Security = {
  // Jangan pakai HTML escaping untuk menyimpan data.
  // Cukup bersihkan control character dan trim.
  sanitizeInput(input) {
    if (typeof input !== "string") return input;

    return input
      .trim()
      .replace(
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
        ""
      );
  },

  // HTML escaping hanya untuk render HTML.
  escapeHtml(text) {
    if (typeof text !== "string") return text;

    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },

  // Decode entity yang sudah terlanjur tersimpan,
  // contoh: Eto&#x27;o -> Eto'o
  decodeHtml(text) {
    if (typeof text !== "string") return text;

    // Cepat: kalau tidak ada entity, langsung return
    if (!/&[#a-zA-Z0-9]+;/.test(text)) return text;

    if (typeof document === "undefined") return text;

    const ta = document.createElement("textarea");
    ta.innerHTML = text;
    const value = ta.value;
    ta.remove();

    return value;
  },

  sanitizeHTML(html) {
    const el = document.createElement("div");
    el.innerText = html;
    return el.innerHTML;
  },

  sanitizeObject(obj) {
    if (Array.isArray(obj)) {
      return obj.map(v => this.sanitizeObject(v));
    }

    if (obj !== null && typeof obj === "object") {
      const sanitizedObj = {};

      for (const [key, value] of Object.entries(obj)) {
        sanitizedObj[this.sanitizeInput(key)] = this.sanitizeObject(value);
      }

      return sanitizedObj;
    }

    if (typeof obj === "string") {
      return this.sanitizeInput(obj);
    }

    return obj;
  }
};
