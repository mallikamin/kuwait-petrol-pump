import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '../api/endpoints';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { toast } from 'sonner';
import { Fuel } from 'lucide-react';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const loginMutation = useMutation({
    mutationFn: () => authApi.login(email, password),
    onSuccess: (response) => {
      const { user, accessToken, refreshToken } = response.data;
      setAuth(user, accessToken, refreshToken);
      toast.success('Login successful');
      navigate('/');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Login failed');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Please enter email and password');
      return;
    }
    loginMutation.mutate();
  };

  const quickLogin = (role: string) => {
    const credentials: Record<string, { email: string; password: string }> = {
      admin: { email: 'admin@petrolpump.com', password: 'password123' },
      manager: { email: 'manager@petrolpump.com', password: 'password123' },
      cashier: { email: 'cashier@petrolpump.com', password: 'password123' },
      operator: { email: 'operator@petrolpump.com', password: 'password123' },
      accountant: { email: 'accountant@petrolpump.com', password: 'password123' },
    };

    const cred = credentials[role];
    if (cred) {
      setEmail(cred.email);
      setPassword(cred.password);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-600 to-blue-800">
      <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-8 shadow-2xl">
        {/* Logo */}
        <div className="flex flex-col items-center">
          <div className="rounded-full bg-blue-100 p-4">
            <Fuel className="h-12 w-12 text-blue-600" />
          </div>
          <h2 className="mt-4 text-3xl font-bold text-slate-900">Kuwait Petrol POS</h2>
          <p className="mt-2 text-sm text-slate-600">Sign in to your account</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <Input
            type="email"
            label="Email Address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@petrolpump.com"
            required
          />

          <Input
            type="password"
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
          />

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            size="lg"
            isLoading={loginMutation.isPending}
          >
            Sign In
          </Button>
        </form>

        {/* Quick Login */}
        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-2 text-slate-500">Quick Login (Demo)</span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            {['admin', 'manager', 'cashier', 'operator', 'accountant'].map((role) => (
              <Button
                key={role}
                variant="outline"
                size="sm"
                onClick={() => quickLogin(role)}
                className="capitalize"
              >
                {role}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
