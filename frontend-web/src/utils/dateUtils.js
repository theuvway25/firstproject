export const formatDate = (dateStringOrDate) => {
  if (!dateStringOrDate) return '';
  
  let date;
  if (typeof dateStringOrDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStringOrDate)) {
    // Parse YYYY-MM-DD as local time to avoid timezone shift
    const [year, month, day] = dateStringOrDate.split('-');
    date = new Date(year, month - 1, day);
  } else {
    date = new Date(dateStringOrDate);
  }

  if (isNaN(date.getTime())) return dateStringOrDate;

  const day = String(date.getDate()).padStart(2, '0');
  const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();

  return `${day}-${month}-${year}`;
};
