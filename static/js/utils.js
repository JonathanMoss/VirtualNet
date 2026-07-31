// Utility Helpers - VirtualNet

/**
 * Formats a JavaScript Date object into a military Date-Time-Group (DTG) string.
 * Example format: "311032Z JUL 26"
 * 
 * @param {Date} d 
 * @returns {string} Formatted DTG string
 */
export function formatDTG(d = new Date()) {
  const offsetMinutes = d.getTimezoneOffset();
  const offsetHours = -offsetMinutes / 60;
  
  let tzLetter = 'Z';
  if (offsetHours === 0) {
    tzLetter = 'Z';
  } else if (offsetHours >= 1 && offsetHours <= 12) {
    const code = 'A'.charCodeAt(0) + (offsetHours - 1);
    const letterCode = offsetHours >= 10 ? code + 1 : code;
    tzLetter = String.fromCharCode(letterCode);
  } else if (offsetHours <= -1 && offsetHours >= -12) {
    const code = 'N'.charCodeAt(0) + (Math.abs(offsetHours) - 1);
    tzLetter = String.fromCharCode(code);
  } else {
    tzLetter = offsetHours > 0 ? 'A' : 'Z';
  }

  const day = String(d.getDate()).padStart(2, '0');
  const hr = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const mon = months[d.getMonth()];
  const yr = String(d.getFullYear()).substring(2);

  return `${day}${hr}${min}${tzLetter} ${mon} ${yr}`;
}
