import type { Metadata } from 'next';
import BangkokPage from '@/components/bangkok/BangkokPage';
import './bangkok.css';

export const metadata: Metadata = { title: { absolute: 'Bangkok flood watch' } };

export default function Page() {
  return <BangkokPage />;
}
