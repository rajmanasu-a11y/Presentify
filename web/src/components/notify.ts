import { notifications } from '@mantine/notifications';
import { friendlyMessage } from '../lib/errors';

export const notifySuccess = (message: string) =>
  notifications.show({ color: 'green', message, autoClose: 4000 });

export const notifyError = (err: unknown) =>
  notifications.show({ color: 'red', message: friendlyMessage(err), autoClose: 8000 });
