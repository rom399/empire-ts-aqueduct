import { ReactNode, useState } from "react";

interface Props {
    title: string;
    /** A short status shown beside the title even when collapsed. */
    badge?: ReactNode;
    children: ReactNode;
    /** Highlighted when something in the scene was just clicked. */
    active?: boolean;
    defaultOpen?: boolean;
    id?: string;
}

/** A collapsible HUD panel. The header is a real button, so it works from the keyboard. */
export function Panel({ title, badge, children, active = false, defaultOpen = true, id }: Props) {
    const [open, setOpen] = useState(defaultOpen);
    const isOpen = open || active;

    return (
        <section className={`panel${active ? " active" : ""}`} id={id}>
            <button type="button" className="panel-head" aria-expanded={isOpen} onClick={() => setOpen(!open)}>
                <span className="panel-title">{title}</span>
                {badge ? <span className="panel-badge">{badge}</span> : null}
                <span className="chevron" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen ? <div className="panel-body">{children}</div> : null}
        </section>
    );
}
