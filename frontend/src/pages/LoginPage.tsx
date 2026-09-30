import { useState, type FormEvent } from "react";
import { ApiError } from "../repository/api";
import { useAuth } from "../state/AuthContext";

const inputCls =
  "w-full px-3.5 py-2.5 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[14px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach the server.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-warmstone-50 flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white border border-warmstone-200 rounded-2xl shadow-sm p-7 space-y-5">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-md shadow-brand-700/20 ring-4 ring-brand-100">
            <span className="material-symbols-outlined text-white text-[22px]">eco</span>
          </div>
          <div>
            <div className="font-bold text-[16px] tracking-tight text-warmstone-900">ANAGROCI</div>
            <div className="text-[12px] font-medium text-warmstone-500">RCN Tracking · sign in</div>
          </div>
        </div>
        <div>
          <label htmlFor="login-username" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Username</label>
          <input id="login-username" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="login-password" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Password</label>
          <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
        </div>
        {error && <p role="alert" className="text-[13px] font-medium text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
        <button
          type="submit"
          disabled={busy || !username.trim() || !password}
          className="w-full px-4 py-2.5 rounded-xl bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-[13.5px] font-bold transition-all shadow-sm"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
