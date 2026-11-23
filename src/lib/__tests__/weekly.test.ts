import { describe, expect, it } from 'vitest';
import { weeklyMessage, weeklyWindow } from '../weekly';

const kst = (s: string) => Date.parse(`${s}+09:00`);

describe('weeklyWindow', () => {
  it('opens on Sunday from 8 pm Korea time and covers Monday to Sunday', () => {
    const w = weeklyWindow(kst('2026-11-22T20:05:00'))!;
    expect(w.weekKey).toBe('2026-11-23');
    expect(w.from).toBe(kst('2026-11-23T00:00:00'));
    expect(w.to).toBe(kst('2026-11-30T00:00:00'));
    expect(weeklyWindow(kst('2026-11-22T23:59:00'))?.weekKey).toBe('2026-11-23');
  });

  it('is closed at any other time', () => {
    expect(weeklyWindow(kst('2026-11-22T19:59:00'))).toBeNull(); // Sunday, too early
    expect(weeklyWindow(kst('2026-11-23T00:01:00'))).toBeNull(); // Monday
    expect(weeklyWindow(kst('2026-11-21T21:00:00'))).toBeNull(); // Saturday
  });
});

describe('weeklyMessage', () => {
  const win = weeklyWindow(kst('2026-11-22T20:30:00'))!;

  it('groups the week by day and leaves out what is outside it', () => {
    const msg = weeklyMessage(
      [
        { title: 'Quiz 4', dueDate: kst('2026-11-25T23:59:00') },
        { title: 'OS HW', dueDate: kst('2026-11-23T10:00:00') },
        { title: 'Lab 7', dueDate: kst('2026-11-25T18:00:00') },
        { title: 'Tonight (this week, not next)', dueDate: kst('2026-11-22T23:00:00') },
        { title: 'Next month', dueDate: kst('2026-12-20T10:00:00') },
      ],
      win,
    );
    expect(msg).toEqual({ title: 'Your week: 3 deadlines', body: 'Mon: OS HW · Wed: Lab 7, Quiz 4' });
  });

  it('says so when nothing is due', () => {
    expect(weeklyMessage([], win)).toEqual({ title: 'Your week: nothing due', body: 'No deadlines from Monday to Sunday. Enjoy it!' });
  });

  it('keeps long weeks short enough for a notification', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ title: `Assignment number ${i}`, dueDate: kst('2026-11-24T12:00:00') + i }));
    const msg = weeklyMessage(many, win);
    expect(msg.title).toBe('Your week: 30 deadlines');
    expect(msg.body.length).toBeLessThanOrEqual(170);
    expect(msg.body.endsWith('…')).toBe(true);
  });
});
