const indianHolidays = [
  // 2025 Holidays
  '2025-01-26', // Republic Day
  '2025-03-14', // Holi
  '2025-03-31', // Eid-ul-Fitr (Ramzan Id)
  '2025-04-10', // Mahavir Jayanti
  '2025-04-14', // Ambedkar Jayanti
  '2025-04-18', // Good Friday
  '2025-05-01', // Maharashtra Day
  '2025-06-06', // Eid-ul-Adha (Bakri Id)
  '2025-07-05', // Muharram
  '2025-08-15', // Independence Day
  '2025-09-05', // Id-E-Milad
  '2025-10-02', // Gandhi Jayanti
  '2025-10-23', // Dussehra
  '2025-11-01', // Diwali
  '2025-11-05', // Guru Nanak Jayanti
  '2025-12-25', // Christmas
  
  // 2026 Holidays
  '2026-01-26', // Republic Day
  '2026-03-03', // Holi
  '2026-03-26', // Shri Ram Navami
  '2026-03-31', // Shri Mahavir Jayanti
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr. Baba Saheb Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-05-28', // Bakri Id (Eid-ul-Adha)
  '2026-06-26', // Muharram
  '2026-09-14', // Ganesh Chaturthi
  '2026-10-02', // Mahatma Gandhi Jayanti
  '2026-10-20', // Dussehra
  '2026-11-10', // Diwali-Balipratipada
  '2026-11-24', // Guru Nanak Jayanti
  '2026-12-25'  // Christmas
];

export const getIstDateString = (date = new Date()) => {
  return new Intl.DateTimeFormat('en-CA', { 
    timeZone: 'Asia/Kolkata', 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit' 
  }).format(date);
};

export const isMarketOpen = () => {
  // Check if today is an official trading holiday
  const todayStr = getIstDateString();
  if (indianHolidays.includes(todayStr)) return false;

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
