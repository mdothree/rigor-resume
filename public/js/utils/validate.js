/**
 * utils/validate.js
 * Input validation utilities used across all projects.
 * Returns { valid: bool, errors: string[] } for form validation.
 * Individual validators return string | null (null = valid).
 */

// ─── Individual field validators ─────────────────────────────────────────────

export const validators = {
  required: (value, label = "This field") =>
    !value?.toString().trim() ? `${label} is required.` : null,

  email: (value) => {
    if (!value?.trim()) return null; // use required() for required check
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
      ? null : "Please enter a valid email address.";
  },

  minLength: (min) => (value, label = "This field") =>
    value?.length < min ? `${label} must be at least ${min} characters.` : null,

  maxLength: (max) => (value, label = "This field") =>
    value?.length > max ? `${label} must be under ${max} characters.` : null,

  url: (value) => {
    if (!value?.trim()) return null;
    try { new URL(value.trim()); return null; }
    catch { return "Please enter a valid URL (include https://)."; }
  },

  numeric: (value, label = "This field") =>
    value && isNaN(Number(value.toString().replace(/[$,]/g, "")))
      ? `${label} must be a number.` : null,

  positiveNumber: (value, label = "This field") => {
    const n = parseFloat(value?.toString().replace(/[$,]/g, ""));
    return isNaN(n) || n <= 0 ? `${label} must be a positive number.` : null;
  },

  domain: (value) => {
    if (!value?.trim()) return null;
    return /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(value.trim())
      ? null : "Please enter a valid domain (e.g. company.com).";
  },

  phone: (value) => {
    if (!value?.trim()) return null;
    return /^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/.test(value.replace(/\s/g,""))
      ? null : "Please enter a valid phone number.";
  },

  minWords: (min) => (value, label = "This field") => {
    const count = value?.trim().split(/\s+/).filter(Boolean).length || 0;
    return count < min ? `${label} needs at least ${min} words.` : null;
  },

  fileSize: (maxMB) => (file) =>
    file && file.size > maxMB * 1024 * 1024
      ? `File must be under ${maxMB}MB.` : null,

  fileType: (allowedTypes) => (file) => {
    if (!file) return null;
    const ext = file.name.split(".").pop().toLowerCase();
    return allowedTypes.includes(ext) ? null
      : `File type .${ext} not allowed. Use: ${allowedTypes.join(", ")}.`;
  },
};

// ─── Form validator ───────────────────────────────────────────────────────────

/**
 * Validate a set of fields at once.
 * @param {Array<{ value, rules: Array<fn>, label?: string }>} fields
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateForm(fields) {
  const errors = [];
  for (const field of fields) {
    for (const rule of field.rules || []) {
      const error = rule(field.value, field.label);
      if (error) { errors.push(error); break; } // one error per field
    }
  }
  return { valid: errors.length === 0, errors };
}

// ─── DOM form validation with visual feedback ─────────────────────────────────

/**
 * Attach validation to an input element. Shows error message below field.
 * @param {string} inputId  - element id
 * @param {Array<fn>} rules - validator functions
 * @param {string} label    - field label for messages
 * @returns {() => boolean} - call to trigger validation
 */
export function attachFieldValidation(inputId, rules, label = "") {
  const input = document.getElementById(inputId);
  if (!input) return () => true;

  function validate() {
    const value = input.value;
    let errorMsg = null;
    for (const rule of rules) {
      errorMsg = rule(value, label);
      if (errorMsg) break;
    }

    // Remove existing error
    const existing = input.parentElement?.querySelector(".field-error");
    if (existing) existing.remove();
    input.classList.remove("input-error");

    if (errorMsg) {
      input.classList.add("input-error");
      const err = document.createElement("p");
      err.className = "field-error";
      err.textContent = errorMsg;
      err.setAttribute("role", "alert");
      input.insertAdjacentElement("afterend", err);
      return false;
    }
    return true;
  }

  input.addEventListener("blur", validate);
  input.addEventListener("input", () => {
    const err = input.parentElement?.querySelector(".field-error");
    if (err) validate();
  });

  return validate;
}

// ─── Quick guard for submit handlers ─────────────────────────────────────────

/**
 * @param {Array<{ id, rules, label }>} fields
 * @param {import('./toast.js').ToastManager} toast
 * @returns {boolean}
 */
export function guardSubmit(fields, toast) {
  const results = fields.map(f => ({
    value: document.getElementById(f.id)?.value?.trim() || "",
    rules: f.rules,
    label: f.label || f.id,
  }));

  const { valid, errors } = validateForm(results);
  if (!valid) {
    toast?.warning(errors[0]);
    // Focus first invalid field
    const firstInvalidId = fields.find((f, i) => {
      for (const rule of f.rules || []) {
        if (rule(results[i].value, f.label)) return true;
      }
      return false;
    })?.id;
    document.getElementById(firstInvalidId)?.focus();
  }
  return valid;
}
