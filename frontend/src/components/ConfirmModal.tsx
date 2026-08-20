export function ConfirmModal({
  message, confirmLabel = 'Confirm', onConfirm, onCancel,
}: { message: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="status-message">{message}</div>
        <div className="modal-actions">
          <button className="host-btn" onClick={onCancel}>Cancel</button>
          <button className="host-btn host-btn--danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
