export const getIstDateString = (date = new Date()) => {
  return new Intl.DateTimeFormat('en-CA', { 
    timeZone: 'Asia/Kolkata', 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit' 
  }).format(date);
};

export const isMarketOpen = () => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  const parts = formatter.formatToParts(new Date());
  const getValue = (type) => parts.find(p => p.type === type)?.value;
  
  const weekday = getValue('weekday'); // "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"
  const hour = parseInt(getValue('hour'), 10);
  const minute = parseInt(getValue('minute'), 10);
  
  if (!weekday || isNaN(hour) || isNaN(minute)) return false;
  if (['Sat', 'Sun'].includes(weekday)) return false;
  
  const timeInMinutes = hour * 60 + minute;
  // 9:15 AM is 555 minutes, 3:30 PM is 930 minutes
  return timeInMinutes >= 555 && timeInMinutes <= 930;
};
