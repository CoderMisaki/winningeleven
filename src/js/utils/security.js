export const Security = {
  sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    // Do not HTML encode, just return the string. We will sanitize on render if needed (though innerText/textContent handles it).
    // The requirement is: "Sanitizer hanya digunakan pada tampilan HTML. Jangan mengubah data asli negara yang akan dipakai Matching Engine."
    return input;
  },

  sanitizeHTML(html) {
    const el = document.createElement("div");
    el.innerText = html;
    return el.innerHTML;
  },

  sanitizeObject(obj) {
    if (Array.isArray(obj)) {
      return obj.map(v => this.sanitizeObject(v));
    } else if (obj !== null && typeof obj === 'object') {
      const sanitizedObj = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitizedObj[this.sanitizeInput(key)] = this.sanitizeObject(value);
      }
      return sanitizedObj;
    } else if (typeof obj === 'string') {
      return this.sanitizeInput(obj);
    }
    return obj;
  }
};
