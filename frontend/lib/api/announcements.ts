import apiClient from './client';
import type { Announcement } from '../types/communication';

function base(orgId: string) {
  return `/api/v1/org/${orgId}/announcements`;
}

export async function getAnnouncements(
  orgId: string,
  params?: { type?: string; scope?: string; priority?: string; pinned?: string },
): Promise<Announcement[]> {
  const res = await apiClient.get(base(orgId), { params });
  return res.data.data;
}

export async function getAnnouncementsPaged(
  orgId: string,
  params: { type?: string; scope?: string; priority?: string; pinned?: string; page: number; pageSize?: number },
): Promise<{ items: Announcement[]; total: number; page: number; pageSize: number }> {
  const res = await apiClient.get(base(orgId), { params });
  return res.data.data;
}

export async function getAnnouncement(orgId: string, id: string): Promise<Announcement> {
  const res = await apiClient.get(`${base(orgId)}/${id}`);
  return res.data.data;
}

export async function createAnnouncement(orgId: string, data: Partial<Announcement>): Promise<Announcement> {
  const res = await apiClient.post(base(orgId), data);
  return res.data.data;
}

export async function updateAnnouncement(orgId: string, id: string, data: Partial<Announcement>): Promise<Announcement> {
  const res = await apiClient.patch(`${base(orgId)}/${id}`, data);
  return res.data.data;
}

export async function publishAnnouncement(orgId: string, id: string): Promise<Announcement> {
  const res = await apiClient.post(`${base(orgId)}/${id}/publish`);
  return res.data.data;
}

export async function togglePinAnnouncement(orgId: string, id: string): Promise<Announcement> {
  const res = await apiClient.post(`${base(orgId)}/${id}/pin`);
  return res.data.data;
}

export async function markAnnouncementRead(orgId: string, id: string): Promise<void> {
  await apiClient.post(`${base(orgId)}/${id}/read`);
}

export async function getReadStatus(orgId: string, id: string) {
  const res = await apiClient.get(`${base(orgId)}/${id}/read-status`);
  return res.data.data;
}

export async function deleteAnnouncement(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`${base(orgId)}/${id}`);
}
