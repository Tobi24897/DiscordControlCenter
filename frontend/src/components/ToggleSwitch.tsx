interface Props {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export default function ToggleSwitch({ checked, onChange, label, disabled }: Props) {
  return (
    <label
      className={`flex shrink-0 items-center gap-1.5 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
    >
      {label && <span className="text-[11px] text-gray-400">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-4 w-7 rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-surface-input'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
            checked ? 'left-3.5' : 'left-0.5'
          }`}
        />
      </button>
    </label>
  );
}
