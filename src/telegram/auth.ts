export function isAuthorizedUser(userId: number | undefined, allowedUserId: string): boolean {
  return userId !== undefined && String(userId) === allowedUserId;
}
