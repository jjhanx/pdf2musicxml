export type PitchAlterOption = '0' | '1' | '-1';

export function pitchAlterFromOption(opt: PitchAlterOption): number | undefined {
  if (opt === '1') return 1;
  if (opt === '-1') return -1;
  return undefined;
}

export function pitchAlterToOption(alter?: number | null): PitchAlterOption {
  if (alter === 1) return '1';
  if (alter === -1) return '-1';
  return '0';
}

export function formatPitchLabel(step: string, octave: number, alter?: number | null): string {
  const acc = alter === 1 ? '♯' : alter === -1 ? '♭' : '';
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
      <option value="-1">♭</option>
    </select>
  );
}
