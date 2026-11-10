/** The app's icon-only button (remove, close, edit): one size and look everywhere, always with a label for screen readers. */
export function IconButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="p-1.5 rounded-lg text-warmstone-400 hover:bg-warmstone-100 hover:text-warmstone-700 transition-colors disabled:opacity-30 disabled:pointer-events-none"
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[20px]">{icon}</span>
    </button>
  );
}
