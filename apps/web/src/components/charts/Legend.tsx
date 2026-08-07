export default function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-gray-600">
      {line
        ? <span style={{ backgroundColor: color }} className="inline-block w-4 h-0.5" />
        : <span style={{ backgroundColor: color }} className="inline-block w-3 h-3 rounded-sm" />}
      {label}
    </span>
  );
}
