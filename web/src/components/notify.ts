import { notifications } from '@mantine/notifications';
import i18n from '../i18n';
import { friendlyMessage } from '../lib/errors';

// The close (×) button needs a name for screen readers.
const closeButtonProps = () => ({ 'aria-label': i18n.t('common.close') });

export const notifySuccess = (message: string) =>
  notifications.show({ color: 'green', message, autoClose: 4000, closeButtonProps: closeButtonProps() });

export const notifyError = (err: unknown) =>
  notifications.show({ color: 'red', message: friendlyMessage(err), autoClose: 8000, closeButtonProps: closeButtonProps() });
