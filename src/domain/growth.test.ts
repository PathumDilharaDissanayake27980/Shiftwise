import { describe, expect, it } from 'vitest';
import { balancedActivities } from './defaults';
import { growthSuggestions } from './growth';

describe('weekly growth check', () => {
  const [learn, build, cert] = balancedActivities(0, 'balanced');
  const stat = (a: typeof learn, planned: number, logged: number) => ({ activity: a!, targetMin: a!.weeklyTargetMin, plannedMin: planned, loggedMin: logged });

  it('levels up goals you hit and steps down goals you miss', () => {
    const s = growthSuggestions([stat(learn, 240, 235), stat(build, 240, 60), stat(cert, 90, 60)]);
    expect(s.map((x) => [x.activity.name, x.kind, x.from, x.to])).toEqual([
      ['Learn (Ascend lessons)', 'up', 240, 270],
      ['Build portfolio project', 'down', 240, 195],
    ]);
    expect(s[0]?.reason).toMatch(/98%/);
  });

  it('says nothing about a week with too little planned to judge', () => {
    expect(growthSuggestions([stat(learn, 45, 0)])).toEqual([]);
  });

  it('never judges a week with nothing logged, or activities newer than that week', () => {
    expect(growthSuggestions([stat(learn, 240, 0), stat(build, 240, 0)])).toEqual([]);
    expect(growthSuggestions([stat(learn, 240, 235), stat(build, 240, 0)], -1)).toEqual([]);
  });
});
