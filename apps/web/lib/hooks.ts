"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { useToast } from "@/components/toast";

export type Role = "INSTITUTE_ADMIN" | "ACCOUNTANT" | "TEACHER" | "STUDENT";

export interface Me {
  user: { id: string; name: string; email: string; phone: string | null; mfaEnabled: boolean; isPlatformAdmin: boolean };
  institute: { id: string; slug: string; name: string; status: string; logoKey: string | null } | null;
  roles: Role[];
  isPlatformAdmin: boolean;
}

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/auth/me"), staleTime: 60_000, retry: false });

export function useHasRole(...roles: Role[]) {
  const me = useMe().data;
  return !!me && roles.some((r) => me.roles.includes(r));
}

/** GET with a cache key derived from the path. */
export function useApi<T>(path: string | null, opts: { key?: QueryKey } = {}) {
  return useQuery({ queryKey: opts.key ?? [path], queryFn: () => api<T>(path!), enabled: !!path });
}

/**
 * A write that shows a toast either way and refreshes the given cached reads afterwards.
 * `invalidate` entries are path prefixes, e.g. "/students".
 */
export function useAction<V, R = unknown>(fn: (vars: V) => Promise<R>, opts: { success?: string | ((r: R) => string); invalidate?: string[]; onSuccess?: (r: R) => void } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      for (const prefix of opts.invalidate ?? []) {
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith(prefix) });
      }
      if (opts.success) toast.success(typeof opts.success === "function" ? opts.success(r) : opts.success);
      opts.onSuccess?.(r);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Something went wrong"),
  });
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
