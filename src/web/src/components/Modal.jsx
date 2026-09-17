import './Modal.css'

// The overlay/card/close-button skeleton ProfileImageModal.jsx and
// InviteMemberModal.jsx each already reimplement independently --
// generalized here since a third and fourth modal (TitleSuggestModal,
// GeneratePostModal) would otherwise be a third and fourth copy-paste
// of the same thing. Those two existing modals are left as they are;
// this isn't a refactor of them, just the pattern new ones follow.
export function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close" title="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
