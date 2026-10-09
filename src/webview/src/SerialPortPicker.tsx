import React, { useEffect, useId, useRef, useState } from "react";

export function SerialPortPicker({ ports, value, onChange, label, chooseLabel, emptyLabel }: {
  ports: string[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  chooseLabel: string;
  emptyLabel: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const picker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node)) { setOpen(false); setActive(-1); }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);
  const choose = (port: string) => { onChange(port); setOpen(false); setActive(-1); };
  return <div className="serial-field">
    <label htmlFor={`${id}-input`}>{label}</label>
    <div className="serial-picker" ref={picker} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); }
    }}>
      <input id={`${id}-input`} role="combobox" aria-autocomplete="none"
        aria-expanded={open} aria-controls={`${id}-list`} aria-haspopup="listbox"
        aria-activedescendant={open && active >= 0 && active < ports.length ? `${id}-option-${active}` : undefined}
        autoComplete="off" value={value} placeholder="COM7"
        onClick={() => { setOpen(true); setActive(-1); }}
        onChange={event => { onChange(event.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActive(previous => {
              if (!ports.length) return -1;
              const next = event.key === "ArrowDown" ? previous + 1 : previous < 0 ? ports.length - 1 : previous - 1;
              return (next + ports.length) % ports.length;
            });
          } else if (event.key === "Enter" && open && active >= 0 && ports[active] !== undefined) {
            event.preventDefault();
            choose(ports[active]!);
          } else if (event.key === "Escape") {
            event.preventDefault(); setOpen(false); setActive(-1);
          }
        }} />
      <button type="button" className="serial-toggle" aria-label={chooseLabel}
        aria-expanded={open} aria-controls={`${id}-list`} aria-haspopup="listbox"
        onMouseDown={event => event.preventDefault()}
        onClick={() => {
          document.getElementById(`${id}-input`)?.focus();
          setOpen(previous => !previous); setActive(-1);
        }} />
      {open && <div id={`${id}-list`} className="serial-options" role="listbox" aria-label={label}>
        {!ports.length && <div className="serial-empty" role="status">{emptyLabel}</div>}
        {ports.map((port, index) => <div key={port} id={`${id}-option-${index}`} role="option"
          aria-selected={port === value} className={active === index ? "active" : ""}
          onMouseDown={event => event.preventDefault()}
          onMouseEnter={() => setActive(index)} onClick={() => choose(port)}>{port}</div>)}
      </div>}
    </div>
  </div>;
}
