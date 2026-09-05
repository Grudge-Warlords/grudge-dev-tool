import React, { useEffect, useRef, useState } from "react";

/** Keep incomplete numeric text visible; browsers sanitize bad number inputs to empty. */
export default function Prompt3DNumberInput({ value, onValueChange, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & { value: number; onValueChange: (value: number) => void }) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : "");
  const emitted = useRef(value);
  useEffect(() => {
    if (!Object.is(value, emitted.current)) {
      setText(Number.isFinite(value) ? String(value) : "");
      emitted.current = value;
    }
  }, [value]);
  return <input {...props} type="text" inputMode="decimal" value={text} aria-invalid={!Number.isFinite(value)} onChange={(event) => {
    const next = event.target.value;
    setText(next);
    const number = next.trim() ? Number(next) : NaN;
    emitted.current = number;
    onValueChange(number);
  }} />;
}
