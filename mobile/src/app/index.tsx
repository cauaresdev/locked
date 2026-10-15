import { Redirect } from 'expo-router';

import { getToken } from '../auth';
import { storedAthlete } from '../storage/db';

export default function Index() {
  if (!getToken()) return <Redirect href="/login" />;
  return <Redirect href={storedAthlete() ? '/today' : '/onboarding'} />;
}
