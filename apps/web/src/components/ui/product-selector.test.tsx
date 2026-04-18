import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProductSelector, ALL_PRODUCTS_VALUE, type ProductOption } from './product-selector';

const makeProducts = (count: number): ProductOption[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `p-${i}`,
    name: `Product ${i.toString().padStart(3, '0')}`,
    sku: `SKU-${i}`,
    category: i % 2 === 0 ? 'Filter' : 'Lubricant',
  }));

describe('ProductSelector', () => {
  it('opens popover and shows all products initially', async () => {
    const onChange = vi.fn();
    render(<ProductSelector products={makeProducts(5)} value={ALL_PRODUCTS_VALUE} onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('Product 000')).toBeInTheDocument();
    expect(screen.getByText('Product 004')).toBeInTheDocument();
  });

  it('filters by name when user types', async () => {
    const onChange = vi.fn();
    render(<ProductSelector products={makeProducts(20)} value={ALL_PRODUCTS_VALUE} onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox'));
    const search = await screen.findByPlaceholderText(/Search by name/i);
    fireEvent.change(search, { target: { value: '015' } });
    expect(screen.getByText('Product 015')).toBeInTheDocument();
    expect(screen.queryByText('Product 014')).not.toBeInTheDocument();
  });

  it('filters by SKU as well as name', async () => {
    const onChange = vi.fn();
    render(<ProductSelector products={makeProducts(10)} value={ALL_PRODUCTS_VALUE} onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox'));
    const search = await screen.findByPlaceholderText(/Search by name/i);
    fireEvent.change(search, { target: { value: 'SKU-7' } });
    expect(screen.getByText('Product 007')).toBeInTheDocument();
  });

  it('handles a 100+ product list without crashing and search still works', async () => {
    const onChange = vi.fn();
    render(<ProductSelector products={makeProducts(120)} value={ALL_PRODUCTS_VALUE} onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox'));
    const search = await screen.findByPlaceholderText(/Search by name/i);
    fireEvent.change(search, { target: { value: 'Product 099' } });
    expect(screen.getByText('Product 099')).toBeInTheDocument();
    expect(screen.getByText(/1 of 120 products/)).toBeInTheDocument();
  });

  it('calls onChange with product id on select', async () => {
    const onChange = vi.fn();
    render(<ProductSelector products={makeProducts(3)} value={ALL_PRODUCTS_VALUE} onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByText('Product 001'));
    expect(onChange).toHaveBeenCalledWith('p-1');
  });

  it('calls onChange with ALL sentinel when "All" is picked', async () => {
    const onChange = vi.fn();
    render(<ProductSelector products={makeProducts(3)} value="p-2" onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByText('All products'));
    expect(onChange).toHaveBeenCalledWith(ALL_PRODUCTS_VALUE);
  });

  it('shows empty state when no products match search', async () => {
    const onChange = vi.fn();
    render(<ProductSelector products={makeProducts(5)} value={ALL_PRODUCTS_VALUE} onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox'));
    const search = await screen.findByPlaceholderText(/Search by name/i);
    fireEvent.change(search, { target: { value: 'zzz-no-match' } });
    expect(screen.getByText(/No products match "zzz-no-match"/)).toBeInTheDocument();
  });

  it('respects disabled prop', () => {
    const onChange = vi.fn();
    render(<ProductSelector products={makeProducts(3)} value={ALL_PRODUCTS_VALUE} onChange={onChange} disabled />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
