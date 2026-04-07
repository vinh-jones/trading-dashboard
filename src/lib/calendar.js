export function getCalendarWeeks(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const weeks = [];
  let current = new Date(firstDay);
  current.setDate(current.getDate() - current.getDay());
  while (current <= lastDay || current.getDay() !== 0) {
    if (weeks.length === 0 || current.getDay() === 0) weeks.push([]);
    weeks[weeks.length - 1].push(new Date(current));
    current.setDate(current.getDate() + 1);
    if (current.getDay() === 0 && current > lastDay) break;
  }
  return weeks;
}
