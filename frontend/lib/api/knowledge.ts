import apiClient from './client';
import type { KnowledgePost, KnowledgeComment } from '../types/communication';

function base(orgId: string) {
  return `/api/v1/org/${orgId}/knowledge`;
}

export async function getKnowledgePosts(
  orgId: string,
  params?: { scope?: string; tag?: string; search?: string },
): Promise<KnowledgePost[]> {
  const res = await apiClient.get(base(orgId), { params });
  return res.data.data;
}

export async function getKnowledgePostsPaged(
  orgId: string,
  params: { scope?: string; tag?: string; search?: string; page: number; pageSize?: number },
): Promise<{ items: KnowledgePost[]; total: number; page: number; pageSize: number }> {
  const res = await apiClient.get(base(orgId), { params });
  return res.data.data;
}

export async function getKnowledgeTags(orgId: string): Promise<string[]> {
  const res = await apiClient.get(`${base(orgId)}/tags`);
  return res.data.data;
}

export async function getKnowledgePost(orgId: string, postId: string): Promise<KnowledgePost> {
  const res = await apiClient.get(`${base(orgId)}/${postId}`);
  return res.data.data;
}

export async function createKnowledgePost(orgId: string, data: Partial<KnowledgePost>): Promise<KnowledgePost> {
  const res = await apiClient.post(base(orgId), data);
  return res.data.data;
}

export async function updateKnowledgePost(orgId: string, postId: string, data: Partial<KnowledgePost>): Promise<KnowledgePost> {
  const res = await apiClient.patch(`${base(orgId)}/${postId}`, data);
  return res.data.data;
}

export async function deleteKnowledgePost(orgId: string, postId: string): Promise<void> {
  await apiClient.delete(`${base(orgId)}/${postId}`);
}

export async function togglePinKnowledge(orgId: string, postId: string): Promise<KnowledgePost> {
  const res = await apiClient.post(`${base(orgId)}/${postId}/pin`);
  return res.data.data;
}

export async function addKnowledgeComment(orgId: string, postId: string, body: string, parent_comment_id?: string): Promise<KnowledgeComment> {
  const res = await apiClient.post(`${base(orgId)}/${postId}/comments`, { body, parent_comment_id });
  return res.data.data;
}

export async function deleteKnowledgeComment(orgId: string, commentId: string): Promise<void> {
  await apiClient.delete(`${base(orgId)}/comments/${commentId}`);
}

export async function toggleKnowledgeReaction(orgId: string, postId: string, emoji: string) {
  const res = await apiClient.post(`${base(orgId)}/${postId}/react`, { emoji });
  return res.data.data;
}
