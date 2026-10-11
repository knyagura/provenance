import { problem } from '@/lib/api/http';

const notFound = () => problem('not-found', 'There is no such API endpoint. See /api/v1/openapi.json.');
export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE };
