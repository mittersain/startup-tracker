import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, UserPermissions, AuthTokens } from '@startup-tracker/shared';

interface AuthState {
  user: User | null;
  permissions: UserPermissions | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;

  setAuth: (user: User, permissions: UserPermissions, tokens: AuthTokens) => void;
  updateTokens: (tokens: AuthTokens) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      permissions: null,
      tokens: null,
      isAuthenticated: false,

      setAuth: (user, permissions, tokens) =>
        set({
          user,
          permissions,
          tokens,
          isAuthenticated: true,
        }),

      updateTokens: (tokens) =>
        set({ tokens }),

      logout: () =>
        set({
          user: null,
          permissions: null,
          tokens: null,
          isAuthenticated: false,
        }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        permissions: state.permissions,
        tokens: state.tokens,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
