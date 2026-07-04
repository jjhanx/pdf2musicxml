export type PitchAlterOption = '0' | '1' | '2' | '-1' | '-2';

export function pitchAlterFromOption(opt: PitchAlterOption): number | undefined {
  if (opt === '0') return undefined;
  return Number(opt);
}

export function pitchAlterToOption(alter?: number | null): PitchAlterOption {
  if (alter === 2) return '2';
  if (alter === 1) return '1';
  if (alter === -1) return '-1';
  if (alter === -2) return '-2';
  return '0';
}

export function formatPitchLabel(step: string, octave: number, alter?: number | null): string {
  const acc =
    alter === 2 ? '♯♯' : alter === 1 ? '♯' : alter === -2 ? '♭♭' : alter === -1 ? '♭' : '';
  return `${step}${acc}${octave}`;
}

export function PitchAlterSelect({
  value,
  onChange,
}: {
  value: PitchAlterOption;
  onChange: (v: PitchAlterOption) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as PitchAlterOption)} aria-label="임시표">
      <option value="0">♮</option>
      <option value="1">♯</option>
      <option value="2">♯♯</option>
      <option value="-1">♭</option>
      <option value="-2">♭♭</option>
    </select>
  );
}
