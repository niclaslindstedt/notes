// A wrap of circular colour swatches — the "pick a colour" surface for a
// namespace's accent. Presentational: the caller owns the selected value
// and is handed the new colour on every pick. The palette itself lives in
// `namespace-colors.ts`.

type Props = {
  colors: readonly string[];
  /** The selected colour, or null when none is chosen yet. */
  value: string | null;
  onChange: (color: string) => void;
  /** Per-swatch aria-label prefix, e.g. "Colour" → "Colour #e06c75". */
  ariaLabelPrefix: string;
};

export function ColorPalette({
  colors,
  value,
  onChange,
  ariaLabelPrefix,
}: Props) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-1.5">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={`${ariaLabelPrefix} ${c}`}
          onClick={() => onChange(c)}
          className={`h-6 w-6 cursor-pointer rounded-full border-2 ${
            c === value ? "border-fg-bright" : "border-transparent"
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}
