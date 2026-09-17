import './Accordion.css'

// Native <details>/<summary> -- free keyboard support and no JS state to
// manage. `defaultOpen` only sets the *initial* open attribute; React
// only touches the DOM when a prop's value actually changes between
// renders, so an unrelated re-render elsewhere on the page (e.g. a
// sibling accordion's own state changing) never snaps this one back
// open or closed against whatever the user last clicked.
export function Accordion({ title, defaultOpen = true, children }) {
  return (
    <details className="accordion" open={defaultOpen}>
      <summary className="accordion-summary">{title}</summary>
      <div className="accordion-body">{children}</div>
    </details>
  )
}
