export const Security = {
  sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return input.replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#x27;")
                .replace(/\//g, "&#x2F;");
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
